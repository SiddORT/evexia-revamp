"""Calendar recurrence in Kolkata; start is a lower bound, never a trigger."""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

ZONE = ZoneInfo("Asia/Kolkata")
REVISION = "0092_low_stock_cron"
LEGACY = dict(event="low_stock_alert", frequency="weekly", weekday=0,
              month_day=None, start_date="1970-01-01", local_time="10:00",
              timezone="Asia/Kolkata")


def next_run(config, after):
    local = after.astimezone(ZONE)
    day = max(local.date(), date.fromisoformat(config["start_date"]))
    clock = time.fromisoformat(config["local_time"])
    # At most one skipped February plus a leap year; bounded even at year 9999.
    for _ in range(370):
        eligible = (config["frequency"] == "daily"
                    or config["frequency"] == "weekly" and day.weekday() == config["weekday"]
                    or config["frequency"] == "monthly" and day.day == config["month_day"])
        instant = datetime.combine(day, clock, ZONE)
        if eligible and instant > local:
            return instant
        if day == date.max:
            break
        day += timedelta(days=1)
    raise ValueError("No representable next occurrence.")
