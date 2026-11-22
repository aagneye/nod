// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev The one NodPolicy function this mock calls back into.
interface INodPolicyPay {
    function pay(address owner, address token, address payee, uint256 amount, bytes32 termsHash) external;
}

/**
 * @title ReentrantERC20
 * @notice TEST ONLY: an ERC-20 whose `transferFrom` calls back into `NodPolicy.pay` once, to prove that
 * NodPolicy's reentrancy guard blocks the nested call.
 * @dev Never deploy this to a live network.
 */
contract ReentrantERC20 is ERC20 {
    address private _policy;
    address private _owner;
    address private _payee;
    uint256 private _amount;

    constructor() ERC20("Reentrant", "RE") {}

    /**
     * @notice Mints `amount` tokens to `to`. Anyone can call it.
     * @param to Recipient of the new tokens.
     * @param amount Amount to mint.
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @notice Arms a single nested `pay(owner, address(this), payee, amount, 0)` call on the next transferFrom.
     * @param policy The NodPolicy contract to call back into.
     * @param owner The owner to spend from in the nested call.
     * @param payee The payee of the nested call.
     * @param amount The amount of the nested call.
     */
    function arm(address policy, address owner, address payee, uint256 amount) external {
        _policy = policy;
        _owner = owner;
        _payee = payee;
        _amount = amount;
    }

    /// @inheritdoc ERC20
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        address policy = _policy;
        if (policy != address(0)) {
            _policy = address(0);
            INodPolicyPay(policy).pay(_owner, address(this), _payee, _amount, bytes32(0));
        }
        return super.transferFrom(from, to, value);
    }
}
