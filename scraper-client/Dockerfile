FROM python:3.12-slim

WORKDIR /app

# xvfb = virtual display server so we can run FULL Chromium (not headless-shell)
# inside a container without a real screen. Chromium's headless-shell binary has
# a fingerprint that Cloudflare and kv.ee's bot detector both recognise; the
# full Chromium binary running under Xvfb looks identical to a real Chrome user.
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb \
      xauth \
    && rm -rf /var/lib/apt/lists/*

COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    playwright install chromium --with-deps

COPY app/ .

# Start Xvfb in the background on display :99, then exec Python with DISPLAY
# pointing to it. Explicit rather than xvfb-run so uvicorn's stdout is not
# swallowed — xvfb-run redirects fds in ways that break log streaming.
CMD ["sh", "-c", "rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 && Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp & export DISPLAY=:99 && sleep 1 && exec python scraper.py"]
