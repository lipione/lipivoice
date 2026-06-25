FROM python:3.11-slim

WORKDIR /worker

ENV PYTHONUNBUFFERED=1

COPY services/livekit-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -m livekit.agents download-files

COPY services/livekit-worker/ .

CMD ["python", "agent.py", "start"]
