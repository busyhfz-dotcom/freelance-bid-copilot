FROM mcr.microsoft.com/playwright:v1.62.0-noble

WORKDIR /app
COPY worker/package*.json ./worker/
RUN cd worker && npm ci --omit=dev --no-audit --no-fund
COPY worker ./worker
COPY extension ./extension
RUN mkdir -p /data/auth /data/state && chown -R pwuser:pwuser /app /data

USER pwuser
ENV NODE_ENV=production BROWSER_DATA_DIR=/data
EXPOSE 8080
CMD ["node", "worker/src/index.mjs"]
