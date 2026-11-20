PRIVATE = ("student list", "roster", "private", "password", "login", "registration number")


def public_image(record: dict) -> bool:
    blob = " ".join(str(record.get(key) or "") for key in ("title", "alt", "caption", "context", "topic", "ocrText", "description", "sourceUrl")).lower()
    return not any(marker in blob for marker in PRIVATE)


def matching_images(records: list[dict], query: str) -> list[dict]:
    tokens = [token for token in "".join(char.lower() if char.isalnum() else " " for char in query).split() if len(token) > 2 and token not in {"the", "show", "official", "photographs", "photos", "image", "images"}]
    found = []
    for record in records:
        if not public_image(record):
            continue
        haystack = " ".join(
            str(record.get(key) or "")
            for key in ("title", "alt", "caption", "context", "topic", "ocrText", "description", "department", "academicYear", "sourceUrl")
        ).lower()
        if tokens and not any(token in haystack for token in tokens):
            continue
        if not tokens:
            continue
        found.append(record)
    return found
