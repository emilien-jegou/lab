FROM busybox:1.37.0 AS busybox-source

FROM debian:stable-slim AS script-prepper
COPY start.sh /start-surreal
RUN chmod +x /start-surreal

FROM surrealdb/surrealdb:latest
USER root

# Copy the binary
COPY --from=busybox-source /bin/busybox /bin/busybox

# USE EXEC FORM HERE: No shell involved
RUN ["/bin/busybox", "--install", "-s", "/bin"]

# Now that /bin/sh exists (as a symlink to busybox), 
# standard shell commands will work for the rest of the file
COPY --from=script-prepper /start-surreal /start-surreal

RUN mkdir /dbdata && chown nonroot:nonroot /dbdata

USER nonroot

EXPOSE 6800
EXPOSE 8000

ENTRYPOINT ["/start-surreal"]
