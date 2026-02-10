// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal on-chain scheduler: payer approves this contract to pull USDC.
/// Anyone can execute when due; the contract transfers to recipients.
interface IERC20 {
  function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract RecurringPayments {
  /// @dev If your token doesn't return a boolean on transferFrom, set this to true.
  /// ARC USDC is expected to be standard ERC20 (returns bool), so default false.
  bool public immutable permissiveToken;

  constructor(bool permissiveToken_) {
    permissiveToken = permissiveToken_;
  }

  struct Schedule {
    address payer;
    address token;
    string name;
    uint64 intervalSeconds;
    uint64 nextRun;
    bool active;
    address[] recipients;
    uint256[] amounts;
    uint256 maxTotal; // cap across all recipients
    uint256 totalPaid; // amount paid so far across all recipients
  }

  uint256 public scheduleCount;
  mapping(uint256 => Schedule) private schedules;
  mapping(address => uint256[]) private schedulesByRecipient;
  mapping(address => uint256[]) private schedulesByPayer;

  event ScheduleCreated(
    uint256 indexed scheduleId,
    address indexed payer,
    address indexed token,
    string name,
    uint256 maxTotal
  );
  event ScheduleExecuted(uint256 indexed scheduleId, uint64 nextRun);
  event ScheduleExecutedWithCatchUp(uint256 indexed scheduleId, uint64 newNextRun, uint256 runs, uint256 paid);
  event ScheduleToggled(uint256 indexed scheduleId, bool active);
  event ScheduleDeleted(uint256 indexed scheduleId);

  error NotPayer();
  error NotActive();
  error TooEarly(uint64 nextRun);
  error BadParams();
  error Completed();

  function _transferFrom(address token, address from, address to, uint256 amount) private {
    IERC20 t = IERC20(token);
    if (permissiveToken) {
      // Some ERC20s don't return a value; a low-level call avoids abi decoding issues.
      (bool ok, bytes memory data) = address(t).call(
        abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
      );
      require(ok && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FROM_FAILED");
    } else {
      require(t.transferFrom(from, to, amount), "TRANSFER_FROM_FAILED");
    }
  }

  function getClaimable(uint256 scheduleId)
    external
    view
    returns (uint256 runs, uint256 claimableAmount, uint64 newNextRun)
  {
    Schedule storage s = schedules[scheduleId];
    if (!s.active) return (0, 0, s.nextRun);
    if (s.totalPaid >= s.maxTotal) return (0, 0, s.nextRun);
    if (block.timestamp < s.nextRun) return (0, 0, s.nextRun);

    uint256 len = s.recipients.length;
    uint256 perRunTotal = 0;
    for (uint256 i = 0; i < len; i++) {
      perRunTotal += s.amounts[i];
    }
    if (perRunTotal == 0) return (0, 0, s.nextRun);

    // runs due = 1 + number of full intervals elapsed since nextRun
    uint256 elapsed = block.timestamp - uint256(s.nextRun);
    uint256 due = 1 + (elapsed / uint256(s.intervalSeconds));

    uint256 remaining = s.maxTotal - s.totalPaid;
    uint256 maxRunsByCap = remaining / perRunTotal;
    if (maxRunsByCap == 0) return (0, 0, s.nextRun);

    runs = due < maxRunsByCap ? due : maxRunsByCap;
    claimableAmount = runs * perRunTotal;
    newNextRun = uint64(uint256(s.nextRun) + runs * uint256(s.intervalSeconds));
  }

  function getSchedulesByRecipient(address recipient) external view returns (uint256[] memory scheduleIds) {
    return schedulesByRecipient[recipient];
  }

  function getSchedulesByPayer(address payer) external view returns (uint256[] memory scheduleIds) {
    return schedulesByPayer[payer];
  }

  function _indexScheduleRecipients(uint256 scheduleId, address[] calldata recipients) private {
    uint256 len = recipients.length;
    for (uint256 i = 0; i < len; i++) {
      schedulesByRecipient[recipients[i]].push(scheduleId);
    }
  }

  function getSchedule(uint256 scheduleId)
    external
    view
    returns (
      address payer,
      address token,
      string memory name,
      uint64 intervalSeconds,
      uint64 nextRun,
      bool active,
      address[] memory recipients,
      uint256[] memory amounts,
      uint256 maxTotal,
      uint256 totalPaid
    )
  {
    Schedule storage s = schedules[scheduleId];
    return (
      s.payer,
      s.token,
      s.name,
      s.intervalSeconds,
      s.nextRun,
      s.active,
      s.recipients,
      s.amounts,
      s.maxTotal,
      s.totalPaid
    );
  }

  function createSchedule(
    address token,
    string calldata name,
    address[] calldata recipients,
    uint256[] calldata amounts,
    uint256 maxTotal,
    uint64 intervalSeconds,
    uint64 firstRun
  ) external returns (uint256 scheduleId) {
    if (token == address(0)) revert BadParams();
    if (recipients.length == 0) revert BadParams();
    if (recipients.length != amounts.length) revert BadParams();
    if (intervalSeconds == 0) revert BadParams();
    if (firstRun < block.timestamp) revert BadParams();
    if (maxTotal == 0) revert BadParams();

    scheduleId = ++scheduleCount;

    Schedule storage s = schedules[scheduleId];
    s.payer = msg.sender;
    s.token = token;
    s.name = name;
    s.intervalSeconds = intervalSeconds;
    s.nextRun = firstRun;
    s.active = true;

    s.recipients = recipients;
    s.amounts = amounts;
    s.maxTotal = maxTotal;
    s.totalPaid = 0;

    _indexScheduleRecipients(scheduleId, recipients);
    schedulesByPayer[msg.sender].push(scheduleId);

    emit ScheduleCreated(scheduleId, msg.sender, token, name, maxTotal);
  }

  function toggleActive(uint256 scheduleId, bool active) external {
    Schedule storage s = schedules[scheduleId];
    if (s.payer != msg.sender) revert NotPayer();
    s.active = active;
    emit ScheduleToggled(scheduleId, active);
  }

  function deleteSchedule(uint256 scheduleId) external {
    Schedule storage s = schedules[scheduleId];
    if (s.payer != msg.sender) revert NotPayer();
    delete schedules[scheduleId];
    emit ScheduleDeleted(scheduleId);
  }

  function execute(uint256 scheduleId) external {
    Schedule storage s = schedules[scheduleId];
    if (!s.active) revert NotActive();
    if (block.timestamp < s.nextRun) revert TooEarly(s.nextRun);
    if (s.totalPaid >= s.maxTotal) revert Completed();

    // Optional: restrict who can execute. Keeping permissionless execution is better for automation.
    // If you want only payer can execute, uncomment the next line.
    // if (msg.sender != s.payer) revert NotPayer();

    uint256 len = s.recipients.length;
    uint256 perRunTotal = 0;
    for (uint256 i = 0; i < len; i++) {
      perRunTotal += s.amounts[i];
    }
    if (perRunTotal == 0) revert BadParams();

    // Catch-up: allow executing multiple missed intervals in one tx (accrue over time),
    // capped by maxTotal.
    uint256 elapsed = block.timestamp - uint256(s.nextRun);
    uint256 dueRuns = 1 + (elapsed / uint256(s.intervalSeconds));

    uint256 remaining = s.maxTotal - s.totalPaid;
    uint256 maxRunsByCap = remaining / perRunTotal;
    if (maxRunsByCap == 0) revert Completed();

    uint256 runs = dueRuns < maxRunsByCap ? dueRuns : maxRunsByCap;
    uint256 payTotal = runs * perRunTotal;

    // Effects first (avoid double execution within same block if token is weird)
    uint64 next = uint64(uint256(s.nextRun) + runs * uint256(s.intervalSeconds));
    s.nextRun = next;
    s.totalPaid += payTotal;
    if (s.totalPaid >= s.maxTotal) {
      // auto-stop once the cap has been fully paid
      s.active = false;
    }

    for (uint256 r = 0; r < runs; r++) {
      for (uint256 i = 0; i < len; i++) {
        _transferFrom(s.token, s.payer, s.recipients[i], s.amounts[i]);
      }
    }

    emit ScheduleExecuted(scheduleId, next);
    emit ScheduleExecutedWithCatchUp(scheduleId, next, runs, payTotal);
  }
}