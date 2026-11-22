// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title NodReceipts
 * @notice Records which settlement transaction paid a set of Nod payment terms.
 * @dev HSP settles payments with EIP-3009 transfers that cannot carry Nod data, so after checking a
 * payment, a recorder (such as the vendor or the Nod server) anchors `termsHash -> settlement` here.
 * Receipts are namespaced by recorder (`msg.sender`): nobody can block or overwrite another recorder's
 * receipt, and each recorder can anchor a given `termsHash` only once. Verifiers decide which recorders
 * they trust; a request counts as paid once its recorder has anchored it. See docs/PROTOCOL.md section 3.
 */
contract NodReceipts {
    /**
     * @notice One anchored settlement.
     * @dev Fields: `settlementTx` is the settlement transaction hash on the payment network, `chainId` that
     * network's chain id, `payer` the address that paid, `payTo` the recipient (`terms.payTo`), `amount` the
     * amount paid in the token's smallest unit, and `anchoredAt` the block timestamp of the anchor
     * (0 means not anchored).
     */
    struct Receipt {
        bytes32 settlementTx;
        uint256 chainId;
        address payer;
        address payTo;
        uint256 amount;
        uint64 anchoredAt;
    }

    /**
     * @notice Emitted when `recorder` anchors the settlement of `termsHash`.
     * @param recorder Address that anchored the receipt (`msg.sender`).
     * @param termsHash EIP-712 hash of the signed Nod terms.
     * @param settlementTx Settlement transaction hash on the payment network.
     * @param chainId Chain id of the payment network.
     * @param payer Address that paid.
     * @param payTo Address that received the payment.
     * @param amount Amount paid, in the token's smallest unit.
     */
    event Anchored(
        address indexed recorder,
        bytes32 indexed termsHash,
        bytes32 settlementTx,
        uint256 chainId,
        address payer,
        address payTo,
        uint256 amount
    );

    /**
     * @notice `recorder` has already anchored a receipt for `termsHash`.
     * @param recorder The recorder that tried to anchor again.
     * @param termsHash The terms hash it already anchored.
     */
    error AlreadyAnchored(address recorder, bytes32 termsHash);

    /// @notice The arrays passed to {anchorBatch} have different lengths.
    error LengthMismatch();

    /// @dev recorder => termsHash => receipt.
    mapping(address recorder => mapping(bytes32 termsHash => Receipt)) private _receipts;

    /**
     * @notice Anchors the settlement of `termsHash` under the caller's namespace.
     * @dev Reverts with {AlreadyAnchored} if the caller has already anchored `termsHash`.
     * @param termsHash EIP-712 hash of the signed Nod terms.
     * @param settlementTx Settlement transaction hash on the payment network.
     * @param chainId Chain id of the payment network.
     * @param payer Address that paid.
     * @param payTo Address that received the payment.
     * @param amount Amount paid, in the token's smallest unit.
     */
    function anchor(
        bytes32 termsHash,
        bytes32 settlementTx,
        uint256 chainId,
        address payer,
        address payTo,
        uint256 amount
    ) external {
        _anchor(termsHash, settlementTx, chainId, payer, payTo, amount);
    }

    /**
     * @notice Anchors several settlements in one transaction. Entry `i` of every array describes one receipt.
     * @dev All-or-nothing: reverts with {LengthMismatch} if the arrays differ in length, and with
     * {AlreadyAnchored} if any entry was already anchored by the caller (including earlier in the same batch).
     * @param termsHashes EIP-712 hashes of the signed Nod terms.
     * @param settlementTxs Settlement transaction hashes on the payment networks.
     * @param chainIds Chain ids of the payment networks.
     * @param payers Addresses that paid.
     * @param payTos Addresses that received the payments.
     * @param amounts Amounts paid, in each token's smallest unit.
     */
    function anchorBatch(
        bytes32[] calldata termsHashes,
        bytes32[] calldata settlementTxs,
        uint256[] calldata chainIds,
        address[] calldata payers,
        address[] calldata payTos,
        uint256[] calldata amounts
    ) external {
        uint256 count = termsHashes.length;
        if (
            settlementTxs.length != count ||
            chainIds.length != count ||
            payers.length != count ||
            payTos.length != count ||
            amounts.length != count
        ) revert LengthMismatch();

        for (uint256 i = 0; i < count; ++i) {
            _anchor(termsHashes[i], settlementTxs[i], chainIds[i], payers[i], payTos[i], amounts[i]);
        }
    }

    /**
     * @notice Returns the receipt `recorder` anchored for `termsHash`.
     * @dev Returns an all-zero receipt (with `anchoredAt == 0`) if there is none.
     * @param recorder The recorder whose namespace to read.
     * @param termsHash EIP-712 hash of the signed Nod terms.
     * @return The anchored receipt.
     */
    function receiptOf(address recorder, bytes32 termsHash) external view returns (Receipt memory) {
        return _receipts[recorder][termsHash];
    }

    /**
     * @notice Whether `recorder` has anchored a receipt for `termsHash`.
     * @param recorder The recorder whose namespace to read.
     * @param termsHash EIP-712 hash of the signed Nod terms.
     * @return True once `recorder` has anchored `termsHash`.
     */
    function isAnchored(address recorder, bytes32 termsHash) external view returns (bool) {
        return _receipts[recorder][termsHash].anchoredAt != 0;
    }

    /// @dev Stores one receipt under `msg.sender` and emits {Anchored}.
    function _anchor(
        bytes32 termsHash,
        bytes32 settlementTx,
        uint256 chainId,
        address payer,
        address payTo,
        uint256 amount
    ) private {
        Receipt storage receipt = _receipts[msg.sender][termsHash];
        if (receipt.anchoredAt != 0) revert AlreadyAnchored(msg.sender, termsHash);

        receipt.settlementTx = settlementTx;
        receipt.chainId = chainId;
        receipt.payer = payer;
        receipt.payTo = payTo;
        receipt.amount = amount;
        // block.timestamp fits in 64 bits for the foreseeable future and is never 0 on a live chain.
        receipt.anchoredAt = uint64(block.timestamp);

        emit Anchored(msg.sender, termsHash, settlementTx, chainId, payer, payTo, amount);
    }
}
