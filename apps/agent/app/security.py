import ipaddress
import re
import socket
from urllib.parse import urljoin, urlparse

ALLOWED_HOST = "lbrce.ac.in"
INJECTION = re.compile(
    r"ignore (?:all |any |the )?(?:previous |prior )?instructions|system prompt|you are now|reveal (?:the )?(?:api key|secret)",
    re.I,
)
OUTSIDE = re.compile(r"\b(random|another college|other college|private college|wikipedia|\biit\b|\bnit\b)\b", re.I)
COLLEGE = re.compile(r"\b(lbrce|lakireddy|mylavaram)\b", re.I)
ROLL = re.compile(r"\b\d{5}[A-Z]\d{2}[A-Z0-9]{2}\b")

Resolver = object


def sanitize(text: str, limit: int = 8000) -> str:
    cleaned = INJECTION.sub("[removed untrusted instruction]", text or "")
    cleaned = ROLL.sub("[redacted]", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()[:limit]


def refuses_outside(message: str) -> bool:
    if COLLEGE.search(message or ""):
        return False
    return bool(OUTSIDE.search(message or ""))


def _private(ip: str) -> bool:
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return True
    return (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    )


def assert_official(raw: str, resolver=None) -> str:
    parsed = urlparse(raw)
    if parsed.scheme != "https":
        raise ValueError("Only HTTPS official URLs are opened")
    host = (parsed.hostname or "").lower().rstrip(".")
    if host != ALLOWED_HOST and not host.endswith(f".{ALLOWED_HOST}"):
        raise ValueError("Host is not on the allowlist")
    if host == f"erp.{ALLOWED_HOST}" or re.search(r"login", parsed.path or "", re.I):
        raise ValueError("Login pages are not public evidence")
    if parsed.username or parsed.password:
        raise ValueError("URLs with credentials are blocked")
    lookup = resolver or (lambda name: [item[4][0] for item in socket.getaddrinfo(name, 443)])
    for address in lookup(host):
        if _private(address):
            raise ValueError("Host resolves to a private address")
    return parsed.geturl()


def same_site(base: str, href: str) -> str | None:
    if not href or href.startswith(("#", "mailto:", "javascript:")):
        return None
    absolute = urljoin(base, href)
    try:
        return assert_official(absolute)
    except ValueError:
        return None
