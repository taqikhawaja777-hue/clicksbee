from app.services.productivity import calculate_productivity, compute_score

# --- compute_score: legacy own-capture-agent formula (active/idle split) --


def test_zero_total_time_returns_zero_not_division_error():
    assert compute_score(active_ms=0, idle_ms=0) == 0.0


def test_all_active_is_full_score():
    assert compute_score(active_ms=1000, idle_ms=0) == 100.0


def test_all_idle_is_zero_score():
    assert compute_score(active_ms=0, idle_ms=1000) == 0.0


def test_mixed_active_and_idle():
    assert compute_score(active_ms=80_000, idle_ms=20_000) == 80.0


def test_score_is_rounded_to_two_decimals():
    # 1 / 3 * 100 = 33.333...
    assert compute_score(active_ms=1, idle_ms=2) == 33.33


# --- calculate_productivity: Jibble-based formula (tracked-time based) ----


def test_zero_tracked_time_returns_zero_not_division_error():
    assert calculate_productivity(tracked_ms=0) == 0.0
    assert calculate_productivity(tracked_ms=0, estimated_minutes=30) == 0.0
    assert calculate_productivity(tracked_ms=0, employee_clocked_ms_today=60_000) == 0.0


def test_estimate_based_scoring_matches_ratio_of_estimate():
    # 30 min tracked against a 60 min estimate -> 50%
    assert calculate_productivity(tracked_ms=30 * 60_000, estimated_minutes=60) == 50.0


def test_estimate_based_scoring_caps_overrun_at_100():
    # 90 min tracked against a 30 min estimate would be 300% uncapped
    assert calculate_productivity(tracked_ms=90 * 60_000, estimated_minutes=30) == 100.0


def test_no_estimate_set_falls_back_to_time_on_task_ratio():
    # 20 min tracked out of 80 min clocked today -> 25%
    assert (
        calculate_productivity(
            tracked_ms=20 * 60_000,
            estimated_minutes=None,
            employee_clocked_ms_today=80 * 60_000,
        )
        == 25.0
    )


def test_no_estimate_and_no_clocked_time_today_scores_zero_not_division_error():
    assert (
        calculate_productivity(
            tracked_ms=10 * 60_000,
            estimated_minutes=None,
            employee_clocked_ms_today=0,
        )
        == 0.0
    )


def test_estimate_of_zero_is_treated_as_not_set():
    # An estimate of 0 minutes isn't a meaningful target - falls back
    # to the time-on-task ratio instead of dividing by zero.
    assert (
        calculate_productivity(
            tracked_ms=10 * 60_000,
            estimated_minutes=0,
            employee_clocked_ms_today=40 * 60_000,
        )
        == 25.0
    )
