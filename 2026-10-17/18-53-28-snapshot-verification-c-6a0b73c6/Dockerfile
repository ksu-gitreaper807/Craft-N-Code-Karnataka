FROM gcc:14.2.0-bookworm@sha256:b99b86a28812b1e6453a231a947dc43d76fe192788a12f344a9b568bf9f5d24c
COPY --chmod=644 runner.py /opt/runner.py
COPY --chmod=644 lib/board_contract.h /opt/lib/board_contract.h
COPY --chmod=644 lib/queue.h /opt/lib/queue.h
RUN chmod -R a+rX /opt
USER 65534:65534
ENTRYPOINT ["python3", "-I", "-B", "/opt/runner.py"]
