// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SessionLib
/// @notice US cash-equity (NYSE regular hours) calendar math in UTC.
/// @dev Regular session: Mon–Fri 09:30–16:00 America/New_York (open inclusive, close exclusive).
///      EDT (UTC-4): 13:30–20:00 UTC. EST (UTC-5): 14:30–21:00 UTC.
///      Every timestamp inside a session falls on the same UTC calendar day as the NY date, so a UTC
///      day index (`ts / 1 days`) is also the NY trading date and the key of the holiday bitmap.
///      DST uses the 2007+ US rule (second Sunday of March to first Sunday of November). The owner
///      can pin it via `DstMode` on the oracle if the rule ever changes.
library SessionLib {
    enum DstMode {
        AUTO,
        FORCE_EDT,
        FORCE_EST
    }

    uint256 internal constant DAY = 1 days;
    uint256 internal constant OPEN_EDT = 13 hours + 30 minutes;
    uint256 internal constant CLOSE_EDT = 20 hours;
    uint256 internal constant OPEN_EST = 14 hours + 30 minutes;
    uint256 internal constant CLOSE_EST = 21 hours;

    /// @notice UTC day index since the Unix epoch.
    function dayIndex(uint256 ts) internal pure returns (uint256) {
        return ts / DAY;
    }

    /// @notice Day of week for a UTC day index. 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday).
    function dayOfWeek(uint256 day) internal pure returns (uint256) {
        return (day + 4) % 7;
    }

    function isWeekday(uint256 day) internal pure returns (bool) {
        uint256 dow = dayOfWeek(day);
        return dow >= 1 && dow <= 5;
    }

    /// @notice Days since epoch for a proleptic Gregorian date (Howard Hinnant's algorithm), for year >= 1970.
    function daysFromCivil(uint256 y, uint256 m, uint256 d) internal pure returns (uint256) {
        if (m <= 2) y -= 1;
        uint256 era = y / 400;
        uint256 yoe = y - era * 400;
        uint256 mp = m > 2 ? m - 3 : m + 9;
        uint256 doy = (153 * mp + 2) / 5 + d - 1;
        uint256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }

    /// @notice Gregorian calendar year of a UTC day index.
    function yearOf(uint256 day) internal pure returns (uint256) {
        uint256 z = day + 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        uint256 m = mp < 10 ? mp + 3 : mp - 9;
        uint256 y = yoe + era * 400;
        return m <= 2 ? y + 1 : y;
    }

    /// @notice Day index of the n-th (1-based) Sunday of `month` in `year`.
    function nthSunday(uint256 year, uint256 month, uint256 n) internal pure returns (uint256) {
        uint256 first = daysFromCivil(year, month, 1);
        uint256 offset = (7 - dayOfWeek(first)) % 7;
        return first + offset + (n - 1) * 7;
    }

    /// @notice True if US Eastern daylight time is in effect at `ts` (2007+ rule).
    /// @dev Starts at 02:00 EST (07:00 UTC) on the 2nd Sunday of March and ends at 02:00 EDT
    ///      (06:00 UTC) on the 1st Sunday of November. Both edges fall on Sundays, so they never
    ///      land inside a cash session.
    function isUsDst(uint256 ts) internal pure returns (bool) {
        uint256 year = yearOf(dayIndex(ts));
        uint256 start = nthSunday(year, 3, 2) * DAY + 7 hours;
        uint256 end = nthSunday(year, 11, 1) * DAY + 6 hours;
        return ts >= start && ts < end;
    }

    /// @notice Regular-session open/close timestamps (UTC) for the trading date `day`.
    /// @dev DST is evaluated at 12:00 UTC of that date, after the 02:00 local switch.
    function sessionTimes(uint256 day, DstMode mode) internal pure returns (uint256 openTs, uint256 closeTs) {
        bool dst;
        if (mode == DstMode.FORCE_EDT) dst = true;
        else if (mode == DstMode.FORCE_EST) dst = false;
        else dst = isUsDst(day * DAY + 12 hours);
        uint256 base = day * DAY;
        if (dst) return (base + OPEN_EDT, base + CLOSE_EDT);
        return (base + OPEN_EST, base + CLOSE_EST);
    }

    /// @notice Holiday bitmap coordinates for a day index.
    function holidaySlot(uint256 day) internal pure returns (uint256 word, uint256 mask) {
        return (day >> 8, uint256(1) << (day & 0xff));
    }
}
