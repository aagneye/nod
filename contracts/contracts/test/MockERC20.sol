// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @notice TEST ONLY: an OpenZeppelin ERC-20 that anyone can mint, with configurable decimals.
 * @dev Never deploy this to a live network.
 */
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    /**
     * @param name_ Token name.
     * @param symbol_ Token symbol.
     * @param decimals_ Token decimals (6 for a USDC-like token).
     */
    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    /// @inheritdoc ERC20
    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Mints `amount` tokens to `to`. Anyone can call it.
     * @param to Recipient of the new tokens.
     * @param amount Amount to mint, in token units.
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
