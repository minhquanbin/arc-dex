// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice InvoiceMarketplace enables simple factoring:
/// - Vendor creates invoice in InvoiceRegistry (vendor, beneficiary, payer, token, amount, status=Created).
/// - Vendor lists invoice for sale at a discount price.
/// - Buyer purchases listing, paying Vendor the list price.
/// - When payer later pays the invoice, funds go to the current beneficiary (buyer).

interface IERC20 {
  function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IInvoiceRegistry {
  // Mirror of InvoiceRegistry.Invoice struct field order:
  // vendor(0), beneficiary(1), payer(2), token(3), amount(4),
  // dueDate(5), status(6), createdAt(7), paidAt(8), metadataHash(9)
  function invoices(bytes32 invoiceId)
    external
    view
    returns (
      address vendor,
      address beneficiary,
      address payer,
      address token,
      uint256 amount,
      uint64 dueDate,
      uint8 status,
      uint64 createdAt,
      uint64 paidAt,
      bytes32 metadataHash
    );

  function transferBeneficiary(bytes32 invoiceId, address newBeneficiary) external;
}

contract InvoiceMarketplace {
  enum ListingStatus {
    None,
    Active,
    Cancelled,
    Sold
  }

  struct Listing {
    bytes32 invoiceId;
    address seller;  // vendor who listed (or current beneficiary if resale allowed)
    address token;   // must match invoice token
    uint256 price;   // in token's smallest units
    ListingStatus status;
    uint64 createdAt;
    uint64 soldAt;
    address buyer;
  }

  IInvoiceRegistry public immutable registry;

  mapping(bytes32 => Listing) public listings; // invoiceId => listing

  bytes32[] private _listingIds; // append-only list of all invoiceIds ever listed

  event InvoiceListed(bytes32 indexed invoiceId, address indexed seller, address token, uint256 price);
  event ListingCancelled(bytes32 indexed invoiceId, address indexed seller);
  event InvoiceSold(bytes32 indexed invoiceId, address indexed seller, address indexed buyer, address token, uint256 price);

  error InvalidParams();
  error NotSeller();
  error NotListable(uint8 invoiceStatus);
  error AlreadyListed();
  error NotActive();
  error TokenMismatch(address invoiceToken, address listingToken);
  error TransferFailed();

  constructor(address invoiceRegistry) {
    if (invoiceRegistry == address(0)) revert InvalidParams();
    registry = IInvoiceRegistry(invoiceRegistry);
  }

  /// @notice Total number of invoiceIds ever listed.
  function totalListingIds() external view returns (uint256) {
    return _listingIds.length;
  }

  /// @notice Returns invoiceIds in the range [offset, offset+limit).
  function getListingIds(uint256 offset, uint256 limit) external view returns (bytes32[] memory) {
    uint256 n = _listingIds.length;
    if (offset >= n || limit == 0) return new bytes32[](0);
    uint256 end = offset + limit;
    if (end > n) end = n;
    uint256 size = end - offset;
    bytes32[] memory out = new bytes32[](size);
    for (uint256 i = 0; i < size; i++) {
      out[i] = _listingIds[offset + i];
    }
    return out;
  }

  /// @notice List an existing invoice for sale at `price` (discounted from face value).
  /// @dev Requires invoice status == Created. Seller must be the invoice vendor.
  function listInvoice(bytes32 invoiceId, uint256 price) external {
    if (invoiceId == bytes32(0) || price == 0) revert InvalidParams();
    if (listings[invoiceId].status == ListingStatus.Active) revert AlreadyListed();

    (address vendor, , , address token, , , uint8 status, , , ) = registry.invoices(invoiceId);
    if (status != 1) revert NotListable(status); // Created only
    if (vendor != msg.sender) revert NotSeller();

    listings[invoiceId] = Listing({
      invoiceId: invoiceId,
      seller: msg.sender,
      token: token,
      price: price,
      status: ListingStatus.Active,
      createdAt: uint64(block.timestamp),
      soldAt: 0,
      buyer: address(0)
    });
    _listingIds.push(invoiceId);

    emit InvoiceListed(invoiceId, msg.sender, token, price);
  }

  function cancelListing(bytes32 invoiceId) external {
    Listing storage l = listings[invoiceId];
    if (l.status != ListingStatus.Active) revert NotActive();
    if (l.seller != msg.sender) revert NotSeller();

    l.status = ListingStatus.Cancelled;
    emit ListingCancelled(invoiceId, msg.sender);
  }

  /// @notice Buy a listed invoice.
  /// Buyer pays seller the list price, then marketplace transfers beneficiary to buyer.
  function buyInvoice(bytes32 invoiceId) external {
    Listing storage l = listings[invoiceId];
    if (l.status != ListingStatus.Active) revert NotActive();

    (address vendor, , , address invoiceToken, , , uint8 status, , , ) = registry.invoices(invoiceId);
    if (status != 1) revert NotListable(status);
    if (invoiceToken != l.token) revert TokenMismatch(invoiceToken, l.token);
    if (vendor != l.seller) revert NotSeller();

    bool ok = IERC20(l.token).transferFrom(msg.sender, l.seller, l.price);
    if (!ok) revert TransferFailed();

    registry.transferBeneficiary(invoiceId, msg.sender);

    l.status = ListingStatus.Sold;
    l.soldAt = uint64(block.timestamp);
    l.buyer = msg.sender;

    emit InvoiceSold(invoiceId, l.seller, msg.sender, l.token, l.price);
  }
}
