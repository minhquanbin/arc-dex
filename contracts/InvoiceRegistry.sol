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
    address vendor; // payee
    address payer;
    address token;
    uint256 amount;
    uint64 dueDate; // unix seconds (optional; 0 allowed)
    Status status;
    uint64 createdAt;
    uint64 paidAt;
    bytes32 metadataHash;
  }

  mapping(bytes32 => Invoice) public invoices;

  event InvoiceCreated(
    bytes32 indexed invoiceId,
    address indexed vendor,
    address indexed payer,
    address token,
    uint256 amount,
    uint64 dueDate,
    bytes32 metadataHash
  );

  event InvoiceCancelled(bytes32 indexed invoiceId, address indexed vendor, bytes32 reasonHash);

  event InvoicePaid(
    bytes32 indexed invoiceId,
    address indexed payer,
    address indexed vendor,
    address token,
    uint256 amount,
    bytes32 metadataHash
  );

  error AlreadyExists(bytes32 invoiceId);
  error NotVendor();
  error NotPayer();
  error InvalidParams();
  error InvalidStatus(Status status);
  error TransferFailed();

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
    if (inv.vendor != msg.sender) revert NotVendor();
    if (inv.status != Status.Created) revert InvalidStatus(inv.status);

    inv.status = Status.Cancelled;
    emit InvoiceCancelled(invoiceId, msg.sender, reasonHash);
  }

  function payInvoice(bytes32 invoiceId) external {
    Invoice storage inv = invoices[invoiceId];
    if (inv.status != Status.Created) revert InvalidStatus(inv.status);
    if (inv.payer != msg.sender) revert NotPayer();

    bool ok = IERC20(inv.token).transferFrom(msg.sender, inv.vendor, inv.amount);
    if (!ok) revert TransferFailed();

    inv.status = Status.Paid;
    inv.paidAt = uint64(block.timestamp);

    emit InvoicePaid(invoiceId, msg.sender, inv.vendor, inv.token, inv.amount, inv.metadataHash);
  }
}
