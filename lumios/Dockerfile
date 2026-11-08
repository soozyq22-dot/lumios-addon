FROM node:22-alpine
# tzdata so scheduled scenes (Open 09:00 / Close 19:00) fire on Chicago wall-clock
# time, not the container's default UTC.
RUN apk add --no-cache tzdata
ENV TZ=America/Chicago
WORKDIR /app
COPY app/ /app/
ENV PORT=4200
ENV HOST=0.0.0.0
ENV LUMIOS_DATA_DIR=/data
ENV LUMIOS_DRIVER=real
EXPOSE 4200
CMD ["node", "server.js"]
