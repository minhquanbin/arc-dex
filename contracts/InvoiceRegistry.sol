// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal on-chain invoice registry for ARC-style USDC payments.
/// - Vendor (payee) creates an invoice for a payer.
/// - Payer pays in a single call using ERC20 transferFrom.
/// - Rich metadata lives off-chain; on-chain stores a metadataHash for integrity.

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract InvoiceRegistry {
    enum Status {
        None,
        Created,
        Cancelled,
        Paid
    }

    struct Invoice {
        address vendor;       // payee
        address beneficiary;  // current recipient of payment (defaults to vendor; transferable for factoring)
        address payer;
        address token;
        uint256 amount;
        uint64 dueDate;       // unix seconds (optional; 0 allowed)
        Status status;
        uint64 createdAt;
        uint64 paidAt;
        bytes32 metadataHash;
    }

    mapping(bytes32 => Invoice) public invoices;

    /// @notice Marketplace allowed to transfer the invoice beneficiary (set to buyer on purchase).
    address public marketplace;

    /// @notice Admin is the deployer — used to configure the marketplace address.
    address public immutable admin;

    // ─── Events ───────────────────────────────────────────────────────────────

    event InvoiceCreated(
        bytes32 indexed invoiceId,
        address indexed vendor,
        address indexed payer,
        address token,
        uint256 amount,
        uint64 dueDate,
        bytes32 metadataHash
    );

    event InvoiceCancelled(
        bytes32 indexed invoiceId,
        address indexed vendor,
        bytes32 reasonHash
    );

    event InvoicePaid(
        bytes32 indexed invoiceId,
        address indexed payer,
        address indexed beneficiary,
        address token,
        uint256 amount,
        bytes32 metadataHash
    );

    event InvoiceBeneficiaryTransferred(
        bytes32 indexed invoiceId,
        address indexed previousBeneficiary,
        address indexed newBeneficiary
    );

    event MarketplaceSet(address indexed marketplace);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error AlreadyExists(bytes32 invoiceId);
    error NotVendor();
    error NotPayer();
    error NotAuthorized();
    error InvalidParams();
    error InvalidStatus(Status status);
    error TransferFailed();

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() {
        admin = msg.sender;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setMarketplace(address newMarketplace) external {
        if (msg.sender != admin) revert NotAuthorized();
        marketplace = newMarketplace;
        emit MarketplaceSet(newMarketplace);
    }

    // ─── Core functions ───────────────────────────────────────────────────────

    function createInvoice(
        bytes32 invoiceId,
        address payer,
        address token,
        uint256 amount,
        uint64 dueDate,
        bytes32 metadataHash
    ) external {
        if (invoiceId == bytes32(0)) revert InvalidParams();
        if (payer == address(0) || token == address(0)) revert InvalidParams();
        if (amount == 0) revert InvalidParams();
        if (invoices[invoiceId].status != Status.None) revert AlreadyExists(invoiceId);

        invoices[invoiceId] = Invoice({
            vendor: msg.sender,
            beneficiary: msg.sender,
            payer: payer,
            token: token,
            amount: amount,
            dueDate: dueDate,
            status: Status.Created,
            createdAt: uint64(block.timestamp),
            paidAt: 0,
            metadataHash: metadataHash
        });

        emit InvoiceCreated(invoiceId, msg.sender, payer, token, amount, dueDate, metadataHash);
    }

    function cancelInvoice(bytes32 invoiceId, bytes32 reasonHash) external {
        Invoice storage inv = invoices[invoiceId];
        if (inv.status == Status.None) revert InvalidParams();
        // Allow the original vendor or the current beneficiary (if factored) to cancel before payment.
        if (inv.vendor != msg.sender && inv.beneficiary != msg.sender) revert NotAuthorized();
        if (inv.status != Status.Created) revert InvalidStatus(inv.status);

        inv.status = Status.Cancelled;
        emit InvoiceCancelled(invoiceId, inv.vendor, reasonHash);
    }

    /// @notice Transfer the right-to-receive payment to a new beneficiary (used by the marketplace).
    /// @dev Only callable by the configured marketplace while invoice is Created.
    function transferBeneficiary(bytes32 invoiceId, address newBeneficiary) external {
        if (msg.sender != marketplace) revert NotAuthorized();
        if (newBeneficiary == address(0)) revert InvalidParams();

        Invoice storage inv = invoices[invoiceId];
        if (inv.status != Status.Created) revert InvalidStatus(inv.status);

        address prev = inv.beneficiary;
        inv.beneficiary = newBeneficiary;

        emit InvoiceBeneficiaryTransferred(invoiceId, prev, newBeneficiary);
    }

    function payInvoice(bytes32 invoiceId) external {
        Invoice storage inv = invoices[invoiceId];
        if (inv.status != Status.Created) revert InvalidStatus(inv.status);
        if (inv.payer != msg.sender) revert NotPayer();

        bool ok = IERC20(inv.token).transferFrom(msg.sender, inv.beneficiary, inv.amount);
        if (!ok) revert TransferFailed();

        inv.status = Status.Paid;
        inv.paidAt = uint64(block.timestamp);

        emit InvoicePaid(invoiceId, msg.sender, inv.beneficiary, inv.token, inv.amount, inv.metadataHash);
    }
}
