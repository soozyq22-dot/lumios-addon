FROM node:22-alpine
WORKDIR /app
COPY app/ /app/
ENV PORT=4200
ENV HOST=0.0.0.0
ENV LUMIOS_DATA_DIR=/data
ENV LUMIOS_DRIVER=real
EXPOSE 4200
CMD ["node", "server.js"]
