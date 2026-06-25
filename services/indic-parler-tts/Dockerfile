FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

WORKDIR /service

ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/models/hf

RUN apt-get update \
  && apt-get install -y --no-install-recommends git libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

COPY services/indic-parler-tts/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/indic-parler-tts/app.py .

EXPOSE 5010
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5010"]
