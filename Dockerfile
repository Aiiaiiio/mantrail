FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY server.js .
COPY db/ ./db/
COPY routes/ ./routes/
COPY middleware/ ./middleware/
COPY ws/ ./ws/
COPY document_root/ ./document_root/
COPY certs/ ./certs/

RUN mkdir -p static/avatars

EXPOSE 22334

CMD ["node", "server.js"]
