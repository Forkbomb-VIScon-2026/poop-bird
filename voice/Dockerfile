# Voice server (voice/server.py). Build from the repo root:
#   docker build -f voice/Dockerfile -t poop-bird-voice .
# The model weights are downloaded on first start into /cache (mount a volume
# there so restarts don't download again). Voice cloning needs HF_TOKEN.
FROM mirror.gcr.io/library/python:3.12-slim
WORKDIR /app
COPY voice/requirements.txt voice/requirements.txt
RUN pip install --no-cache-dir -r voice/requirements.txt \
      --extra-index-url https://download.pytorch.org/whl/cpu
COPY voice/server.py voice/test_server.py voice/lines.json voice/
RUN useradd --create-home app && mkdir /cache && chown app:app /cache
USER app
ENV HF_HOME=/cache PORT=8790 PYTHONUNBUFFERED=1
EXPOSE 8790
CMD ["python", "voice/server.py"]
