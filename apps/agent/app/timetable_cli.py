"""Read one official timetable image and print only cells confirmed by a second OCR."""

import json
import sys
from urllib.request import Request, urlopen

from app.documents import confirmed_timetable


def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else ""
    host = url.split("/")[2].lower() if url.startswith("https://") and url.count("/") >= 2 else ""
    if host != "lbrce.ac.in" and not host.endswith(".lbrce.ac.in"):
        print("[]")
        return
    request = Request(url, headers={"user-agent": "LBRCE-AI-Bot/1.0"})
    with urlopen(request, timeout=30) as response:
        data = response.read()
    print(json.dumps(confirmed_timetable(data)))


if __name__ == "__main__":
    main()
