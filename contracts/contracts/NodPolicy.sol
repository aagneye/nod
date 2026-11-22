// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title NodPolicy
 * @notice Lets an owner give an agent a spending cap per period, in one ERC-20 token, for payees the
 * owner allows, so the agent can pay small amounts without asking each time.
 * @dev Funds stay in the owner's wallet: the owner approves this contract for the token, and {pay} moves
 * tokens straight from the owner to the payee with `SafeERC20.safeTransferFrom`. Revoking the policy, or
 * the token approval, stops the agent immediately. Policies are keyed by (owner, agent, token); payee
 * allowlists by (owner, agent). See docs/PROTOCOL.md section 4.
 */
contract NodPolicy is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /**
     * @notice Spending limits for one (owner, agent, token).
     * @dev Fields: `cap` is the most the agent may spend per period (token units), `period` the period
     * length in seconds, `periodStart` the start of the current period (unix seconds), `spent` the amount
     * spent in that period, and `active` whether the policy is in force. Periods are aligned to the time the
     * policy was set: a new period starts once `block.timestamp >= periodStart + period`.
     */
    struct Policy {
        uint128 cap;
        uint64 period;
        uint64 periodStart;
        uint128 spent;
        bool active;
    }

    /**
     * @notice Emitted when `owner` sets (or resets) the policy for `agent` and `token`.
     * @param owner The owner whose funds the agent may spend.
     * @param agent The agent allowed to spend.
     * @param token The ERC-20 token the policy applies to.
     * @param cap Most the agent may spend per period, in token units.
     * @param period Period length in seconds.
     */
    event PolicySet(address indexed owner, address indexed agent, address indexed token, uint128 cap, uint64 period);

    /**
     * @notice Emitted when `owner` allows or disallows `payee` for `agent`.
     * @param owner The owner.
     * @param agent The agent.
     * @param payee The payee.
     * @param allowed Whether `agent` may now pay `payee`.
     */
    event PayeeAllowed(address indexed owner, address indexed agent, address indexed payee, bool allowed);

    /**
     * @notice Emitted when `owner` revokes the policy for `agent` and `token`.
     * @param owner The owner.
     * @param agent The agent.
     * @param token The token.
     */
    event PolicyRevoked(address indexed owner, address indexed agent, address indexed token);

    /**
     * @notice Emitted when `agent` pays `payee` from `owner`'s funds under a policy.
     * @param owner The owner whose tokens moved.
     * @param agent The agent that paid (`msg.sender`).
     * @param payee The recipient.
     * @param token The ERC-20 token.
     * @param amount Amount paid, in token units.
     * @param termsHash EIP-712 hash of the Nod terms being paid (or zero if none).
     */
    event PolicyPaid(
        address indexed owner,
        address indexed agent,
        address indexed payee,
        address token,
        uint256 amount,
        bytes32 termsHash
    );

    /// @notice An agent, token or payee address is zero.
    error ZeroAddress();

    /// @notice {setPolicy} was called with a zero cap or a zero period.
    error InvalidLimits();

    /// @notice {pay} was called with a zero amount.
    error ZeroAmount();

    /**
     * @notice There is no active policy for (`owner`, `agent`, `token`).
     * @param owner The owner passed to {pay}.
     * @param agent The caller of {pay}.
     * @param token The token passed to {pay}.
     */
    error PolicyInactive(address owner, address agent, address token);

    /**
     * @notice `owner` has not allowed `agent` to pay `payee`.
     * @param owner The owner passed to {pay}.
     * @param agent The caller of {pay}.
     * @param payee The payee passed to {pay}.
     */
    error PayeeNotAllowed(address owner, address agent, address payee);

    /**
     * @notice The payment would take the agent over its cap for the current period.
     * @param available What the agent can still spend in the current period.
     * @param amount The amount requested.
     */
    error CapExceeded(uint256 available, uint256 amount);

    /// @dev owner => agent => token => policy.
    mapping(address owner => mapping(address agent => mapping(address token => Policy))) private _policies;

    /// @dev owner => agent => payee => allowed.
    mapping(address owner => mapping(address agent => mapping(address payee => bool))) private _allowedPayees;

    /**
     * @notice Lets `agent` spend up to `cap` of `token` from the caller's wallet every `period` seconds.
     * @dev The caller is the owner. Setting a policy that already exists replaces it: `spent` goes back to 0
     * and a new period starts now. The owner must also approve this contract for `token` and allow payees
     * with {allowPayee}.
     * @param agent The agent allowed to spend.
     * @param token The ERC-20 token.
     * @param cap Most the agent may spend per period, in token units (must be > 0).
     * @param period Period length in seconds (must be > 0).
     */
    function setPolicy(address agent, address token, uint128 cap, uint64 period) external {
        if (agent == address(0) || token == address(0)) revert ZeroAddress();
        if (cap == 0 || period == 0) revert InvalidLimits();

        _policies[msg.sender][agent][token] = Policy({
            cap: cap,
            period: period,
            // block.timestamp fits in 64 bits for the foreseeable future.
            periodStart: uint64(block.timestamp),
            spent: 0,
            active: true
        });

        emit PolicySet(msg.sender, agent, token, cap, period);
    }

    /**
     * @notice Allows or disallows `agent` to pay `payee` from the caller's funds (for every token).
     * @dev The caller is the owner.
     * @param agent The agent.
     * @param payee The payee.
     * @param allowed Whether `agent` may pay `payee`.
     */
    function allowPayee(address agent, address payee, bool allowed) external {
        if (agent == address(0) || payee == address(0)) revert ZeroAddress();
        _allowedPayees[msg.sender][agent][payee] = allowed;
        emit PayeeAllowed(msg.sender, agent, payee, allowed);
    }

    /**
     * @notice Revokes the caller's policy for `agent` and `token`; the agent cannot spend it from now on.
     * @dev The caller is the owner. Clears the policy (so {policyOf} returns all zeros) and always emits
     * {PolicyRevoked}, even if there was no policy. Payee allowlists are left unchanged.
     * @param agent The agent.
     * @param token The token.
     */
    function revoke(address agent, address token) external {
        delete _policies[msg.sender][agent][token];
        emit PolicyRevoked(msg.sender, agent, token);
    }

    /**
     * @notice Pays `amount` of `token` from `owner` to `payee` under the policy `owner` set for the caller.
     * @dev The caller is the agent. Requires an active policy for (owner, caller, token), an allowed payee,
     * and `spent + amount <= cap` within the current period; a new period starts once
     * `block.timestamp >= periodStart + period`. Tokens move with `safeTransferFrom(owner, payee, amount)`,
     * so `owner` must have approved this contract for at least `amount`.
     * @param owner The owner whose tokens to spend.
     * @param token The ERC-20 token.
     * @param payee The recipient; must be allowed for the caller.
     * @param amount Amount to pay, in token units (must be > 0).
     * @param termsHash EIP-712 hash of the Nod terms being paid, recorded in {PolicyPaid} (may be zero).
     */
    function pay(address owner, address token, address payee, uint256 amount, bytes32 termsHash)
        external
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();

        Policy memory policy = _currentPeriod(_policies[owner][msg.sender][token]);
        if (!policy.active) revert PolicyInactive(owner, msg.sender, token);
        if (!_allowedPayees[owner][msg.sender][payee]) revert PayeeNotAllowed(owner, msg.sender, payee);

        // spent <= cap always holds, so this cannot underflow, and spent + amount <= cap fits in 128 bits.
        uint256 available = policy.cap - policy.spent;
        if (amount > available) revert CapExceeded(available, amount);
        policy.spent += uint128(amount);
        _policies[owner][msg.sender][token] = policy;

        emit PolicyPaid(owner, msg.sender, payee, token, amount, termsHash);
        IERC20(token).safeTransferFrom(owner, payee, amount);
    }

    /**
     * @notice Returns the policy `owner` set for `agent` and `token`, as it applies in the current block.
     * @dev If the stored period has ended, the result shows the period that applies now (`periodStart` rolled
     * forward, `spent` = 0), exactly as the next {pay} would see it; storage is updated by {pay}. Returns all
     * zeros if there is no policy (or it was revoked).
     * @param owner The owner.
     * @param agent The agent.
     * @param token The token.
     * @return The policy for the current period.
     */
    function policyOf(address owner, address agent, address token) external view returns (Policy memory) {
        return _currentPeriod(_policies[owner][agent][token]);
    }

    /**
     * @notice Whether `owner` allows `agent` to pay `payee`.
     * @param owner The owner.
     * @param agent The agent.
     * @param payee The payee.
     * @return True if `agent` may pay `payee` from `owner`'s funds.
     */
    function isPayeeAllowed(address owner, address agent, address payee) external view returns (bool) {
        return _allowedPayees[owner][agent][payee];
    }

    /**
     * @dev Returns `policy` rolled forward to the period containing `block.timestamp`. Periods stay aligned to
     * the time the policy was set: `periodStart` advances by whole periods and `spent` resets to 0. Inactive
     * policies are returned unchanged. All math is in 256 bits, so a huge `period` cannot overflow; an active
     * policy always has `period > 0`.
     */
    function _currentPeriod(Policy memory policy) private view returns (Policy memory) {
        if (policy.active && block.timestamp >= uint256(policy.periodStart) + policy.period) {
            uint256 elapsed = block.timestamp - policy.periodStart;
            // The new start is <= block.timestamp, so it fits in 64 bits.
            policy.periodStart = uint64(policy.periodStart + elapsed - (elapsed % policy.period));
            policy.spent = 0;
        }
        return policy;
    }
}
