FROM gcc:14.2.0-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3-minimal \
    && rm -rf /var/lib/apt/lists/*
COPY runner.py /opt/runner.py
COPY lib /opt/lib
USER 65534:65534
ENTRYPOINT ["python3", "-I", "-B", "/opt/runner.py"]
