// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
  function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @notice EOA-friendly batch payments: user approves token allowance once, then executes a single
///         transaction to pay many recipients.
contract BatchPayments {
  error LengthMismatch();
  error ZeroRecipient(uint256 index);
  error TransferFailed(uint256 index);

  event BatchTransferFrom(
    address indexed token,
    address indexed from,
    uint256 recipients,
    uint256 totalAmount
  );

  function batchTransferFrom(
    address token,
    address[] calldata recipients,
    uint256[] calldata amounts
  ) external {
    if (recipients.length != amounts.length) revert LengthMismatch();

    uint256 total;

    for (uint256 i = 0; i < recipients.length; i++) {
      address to = recipients[i];
      if (to == address(0)) revert ZeroRecipient(i);

      uint256 amount = amounts[i];
      total += amount;

      bool ok = IERC20(token).transferFrom(msg.sender, to, amount);
      if (!ok) revert TransferFailed(i);
    }

    emit BatchTransferFrom(token, msg.sender, recipients.length, total);
  }
}