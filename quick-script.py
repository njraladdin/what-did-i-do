import argparse
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable


CATEGORY_ORDER = ["WORK", "LEARN", "SOCIAL", "ENTERTAINMENT", "OTHER", "UNKNOWN"]
REDUNDANT_SENTENCE_PATTERNS = [
    re.compile(r"^overall[, ]", re.I),
    re.compile(r"^overall activity", re.I),
    re.compile(r"^the overall activity", re.I),
    re.compile(r"^the overall context", re.I),
    re.compile(r"^this suggests", re.I),
    re.compile(r"^the presence of", re.I),
    re.compile(r"^the user seems to be", re.I),
    re.compile(r"^the user appears to be", re.I),
    re.compile(r"^the user is likely", re.I),
    re.compile(r"^the user is currently", re.I),
]
PREFIX_PATTERNS = [
    re.compile(r"^the user is\s+", re.I),
    re.compile(r"^the user appears to be\s+", re.I),
    re.compile(r"^the user seems to be\s+", re.I),
    re.compile(r"^the user is currently\s+", re.I),
    re.compile(r"^the screen shows\s+", re.I),
    re.compile(r"^the interface shows\s+", re.I),
]


@dataclass
class Session:
    category: str
    activity: str
    start: datetime
    end: datetime
    count: int = 0
    descriptions: list[str] = field(default_factory=list)

    def add(self, timestamp: datetime, description: str) -> None:
        self.end = timestamp
        self.count += 1
        if description and description not in self.descriptions:
            self.descriptions.append(description)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert a What Did I Do export JSON into a compact Markdown summary."
    )
    parser.add_argument(
        "input",
        nargs="?",
        default="what-did-i-do-export-custom-2026-03-07.json",
        help="Path to the exported JSON file.",
    )
    parser.add_argument(
        "-o",
        "--output",
        help="Path to write the Markdown output. Defaults to <input>-compact.md",
    )
    parser.add_argument(
        "--merge-gap-minutes",
        type=int,
        default=12,
        help="Merge consecutive screenshots into one session when the gap is below this value.",
    )
    parser.add_argument(
        "--max-description-sentences",
        type=int,
        default=1,
        help="Maximum normalized sentences to keep per screenshot/session summary.",
    )
    return parser.parse_args()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def round_value(value: float, digits: int = 1) -> str:
    rounded = round(value, digits)
    if float(rounded).is_integer():
        return str(int(rounded))
    return f"{rounded:.{digits}f}".rstrip("0").rstrip(".")


def split_sentences(text: str) -> list[str]:
    return [
        sentence.strip(" -")
        for sentence in re.split(r"(?<=[.!?])\s+", text.strip())
        if sentence.strip()
    ]


def normalize_sentence(sentence: str) -> str:
    sentence = sentence.strip()
    for pattern in PREFIX_PATTERNS:
        sentence = pattern.sub("", sentence)
    sentence = sentence.replace("The user ", "")
    sentence = re.sub(r"\s+", " ", sentence)
    sentence = sentence.strip(" .")
    if not sentence:
        return ""
    sentence = sentence[0].upper() + sentence[1:]
    return sentence


def is_redundant_sentence(sentence: str) -> bool:
    lowered = sentence.lower().strip()
    if len(lowered) < 20:
        return True
    return any(pattern.search(lowered) for pattern in REDUNDANT_SENTENCE_PATTERNS)


def compact_description(text: str, max_sentences: int) -> str:
    kept: list[str] = []
    seen: set[str] = set()
    for raw in split_sentences(text):
        normalized = normalize_sentence(raw)
        key = re.sub(r"[^a-z0-9]+", " ", normalized.lower()).strip()
        if not normalized or not key or key in seen:
            continue
        if is_redundant_sentence(normalized):
            continue
        seen.add(key)
        kept.append(normalized)
        if len(kept) >= max_sentences:
            break
    if not kept:
        fallback = normalize_sentence(text)
        return fallback[:180].rstrip(" .,;")
    return "; ".join(kept)[:180].rstrip(" .,;")


def format_range(start: datetime, end: datetime) -> str:
    start_str = start.strftime("%H:%M")
    end_str = end.strftime("%H:%M")
    return start_str if start_str == end_str else f"{start_str}-{end_str}"


def format_stats_line(values: dict[str, float], unit: str) -> str:
    parts = []
    for category in CATEGORY_ORDER:
        value = values.get(category, 0)
        if not value:
            continue
        suffix = unit
        parts.append(f"{category.lower()} {round_value(value)}{suffix}")
    return ", ".join(parts)


def merge_sessions(
    screenshots: list[dict], merge_gap_minutes: int, max_description_sentences: int
) -> dict[str, list[Session]]:
    sessions_by_day: dict[str, list[Session]] = {}
    current: Session | None = None

    sorted_shots = sorted(screenshots, key=lambda item: item["timestamp"])
    for shot in sorted_shots:
        timestamp = parse_timestamp(shot["timestamp"])
        day_key = timestamp.date().isoformat()
        description = compact_description(shot.get("description", ""), max_description_sentences)
        category = shot.get("category") or "UNKNOWN"
        activity = (shot.get("activity") or "Unknown").strip()

        should_merge = (
            current is not None
            and day_key == current.start.date().isoformat()
            and current.category == category
            and current.activity == activity
            and (timestamp - current.end).total_seconds() <= merge_gap_minutes * 60
        )

        if not should_merge:
            current = Session(
                category=category,
                activity=activity,
                start=timestamp,
                end=timestamp,
            )
            current.add(timestamp, description)
            sessions_by_day.setdefault(day_key, []).append(current)
            continue

        current.add(timestamp, description)

    return sessions_by_day


def collect_top_activities(screenshots: Iterable[dict], limit: int = 8) -> str:
    counter = Counter()
    for shot in screenshots:
        activity = (shot.get("activity") or "Unknown").strip()
        counter[(shot.get("category") or "UNKNOWN", activity)] += 1
    parts = [
        f"{activity} [{category.lower()}] x{count}"
        for (category, activity), count in counter.most_common(limit)
    ]
    return ", ".join(parts)


def build_markdown(data: dict, merge_gap_minutes: int, max_description_sentences: int) -> str:
    metadata = data.get("metadata", {})
    screenshots = data.get("screenshots", [])
    statistics = data.get("statistics", {})
    sessions_by_day = merge_sessions(screenshots, merge_gap_minutes, max_description_sentences)

    lines: list[str] = ["# Compact Activity Export", ""]
    lines.append("## Overview")
    lines.append(
        f"- export_date: {metadata.get('exportDate', 'unknown')}"
    )
    date_range = metadata.get("dateRange", {})
    lines.append(
        f"- date_range: {date_range.get('startDate', 'unknown')} to {date_range.get('endDate', 'unknown')}"
    )
    lines.append(f"- screenshots: {len(screenshots)}")
    lines.append(f"- top_activities: {collect_top_activities(screenshots)}")
    lines.append("")

    daily_stats = statistics.get("dailyStats", {})
    if daily_stats:
        lines.append("## Daily Summaries")
        for day in sorted(sessions_by_day):
            lines.append(f"### {day}")
            stats = daily_stats.get(day, {})
            counts = stats.get("categoryCounts", {})
            hours = stats.get("timeInHours", {})
            percentages = stats.get("percentages", {})
            if counts:
                lines.append(f"- counts: {format_stats_line(counts, '')}")
            if hours:
                lines.append(f"- hours: {format_stats_line(hours, 'h')}")
            if percentages:
                lines.append(f"- share: {format_stats_line(percentages, '%')}")
            for session in sessions_by_day[day]:
                summary = " | ".join(session.descriptions[:1])
                lines.append(
                    f"- {format_range(session.start, session.end)} | {session.category} | {session.activity} | {session.count} shots | {summary}"
                )
            lines.append("")
    else:
        lines.append("## Sessions")
        for day in sorted(sessions_by_day):
            lines.append(f"### {day}")
            for session in sessions_by_day[day]:
                summary = " | ".join(session.descriptions[:1])
                lines.append(
                    f"- {format_range(session.start, session.end)} | {session.category} | {session.activity} | {session.count} shots | {summary}"
                )
            lines.append("")

    monthly_stats = statistics.get("monthlyStats", {})
    if monthly_stats:
        lines.append("## Monthly Stats")
        for month in sorted(monthly_stats):
            stats = monthly_stats[month]
            lines.append(f"### {month}")
            if stats.get("monthlyAverages"):
                lines.append(
                    f"- avg_share: {format_stats_line(stats['monthlyAverages'], '%')}"
                )
            if stats.get("monthlyTimeInHours"):
                lines.append(
                    f"- total_hours: {format_stats_line(stats['monthlyTimeInHours'], 'h')}"
                )
            if "daysWithData" in stats:
                lines.append(f"- days_with_data: {stats['daysWithData']}")
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output) if args.output else input_path.with_name(f"{input_path.stem}-compact.md")

    data = load_json(input_path)
    markdown = build_markdown(data, args.merge_gap_minutes, args.max_description_sentences)
    output_path.write_text(markdown, encoding="utf-8")
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
