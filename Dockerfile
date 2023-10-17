FROM node:18.18.1-alpine3.18

WORKDIR /app

COPY package.json /app/

RUN npm install

RUN apk add  --no-cache ffmpeg

