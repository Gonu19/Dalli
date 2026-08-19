"""add stored active duration to runs

Revision ID: b6e4a9d12f30
Revises: 8d2f0a1c4b6e
Create Date: 2026-08-19
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "b6e4a9d12f30"
down_revision: str | Sequence[str] | None = "8d2f0a1c4b6e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "runs",
        sa.Column("active_duration_sec", sa.Integer(), nullable=True),
    )

    # Existing APP events are valid RunEvent JSONB. Pair each PAUSE with the
    # next RESUME/RUN_END on the same timeline; an unmatched pause ends at
    # duration_sec, matching run_quality.compute_pause_intervals().
    op.execute(
        sa.text(
            """
            WITH valid_events AS (
                SELECT
                    r.id,
                    item.ordinality,
                    item.event->>'type' AS event_type,
                    (item.event->>'t')::double precision AS event_time
                FROM runs AS r
                CROSS JOIN LATERAL jsonb_array_elements(
                    CASE
                        WHEN jsonb_typeof(r.events) = 'array' THEN r.events
                        ELSE '[]'::jsonb
                    END
                ) WITH ORDINALITY AS item(event, ordinality)
                WHERE jsonb_typeof(item.event->'t') = 'number'
                  AND (item.event->>'t')::double precision >= 0
                  AND (item.event->>'t')::double precision <= r.duration_sec
                  AND item.event->>'type' IN ('PAUSE', 'RESUME', 'RUN_END')
            ), pause_durations AS (
                SELECT
                    pause.id,
                    SUM(
                        GREATEST(
                            0.0,
                            LEAST(
                                r.duration_sec::double precision,
                                COALESCE(
                                    (
                                        SELECT endpoint.event_time
                                        FROM valid_events AS endpoint
                                        WHERE endpoint.id = pause.id
                                          AND (endpoint.event_time, endpoint.ordinality)
                                              > (pause.event_time, pause.ordinality)
                                          AND endpoint.event_type IN ('RESUME', 'RUN_END')
                                          AND NOT EXISTS (
                                              SELECT 1
                                              FROM valid_events AS stop
                                              WHERE stop.id = pause.id
                                                AND stop.event_type = 'RUN_END'
                                                AND (stop.event_time, stop.ordinality)
                                                    > (pause.event_time, pause.ordinality)
                                                AND (stop.event_time, stop.ordinality)
                                                    < (endpoint.event_time, endpoint.ordinality)
                                          )
                                        ORDER BY endpoint.event_time, endpoint.ordinality
                                        LIMIT 1
                                    ),
                                    r.duration_sec::double precision
                                ) - pause.event_time
                            )
                        )
                    ) AS pause_sec
                FROM valid_events AS pause
                JOIN runs AS r ON r.id = pause.id
                WHERE pause.event_type = 'PAUSE'
                GROUP BY pause.id
            )
            UPDATE runs AS r
            SET active_duration_sec = ROUND(
                GREATEST(
                    0.0,
                    LEAST(
                        r.duration_sec::double precision,
                        r.duration_sec::double precision
                            - COALESCE(pause_durations.pause_sec, 0.0)
                    )
                )
            )::integer
            FROM pause_durations
            WHERE pause_durations.id = r.id;

            UPDATE runs
            SET active_duration_sec = duration_sec
            WHERE active_duration_sec IS NULL;
            """
        )
    )

    op.alter_column(
        "runs",
        "active_duration_sec",
        existing_type=sa.Integer(),
        nullable=False,
    )


def downgrade() -> None:
    op.drop_column("runs", "active_duration_sec")
