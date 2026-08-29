FROM mcr.microsoft.com/playwright:v1.62.0-noble

WORKDIR /app
COPY worker/package*.json ./worker/
RUN cd worker && npm ci --omit=dev --no-audit --no-fund
COPY worker ./worker
COPY extension ./extension
RUN mkdir -p /data/auth /data/state && chown -R pwuser:pwuser /app /data
COPY worker/docker-entrypoint.sh /usr/local/bin/bid-copilot-entrypoint
RUN chmod 0755 /usr/local/bin/bid-copilot-entrypoint && command -v runuser >/dev/null

ENV NODE_ENV=production BROWSER_DATA_DIR=/data
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/bid-copilot-entrypoint"]
CMD ["node", "worker/src/index.mjs"]
