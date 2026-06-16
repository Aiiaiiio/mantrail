FROM node:20-alpine
ARG COMMIT_HASH
ARG BRANCH
ENV COMMIT_HASH=$COMMIT_HASH
ENV BRANCH=$BRANCH
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

RUN mkdir -p data/avatars

EXPOSE 22334

CMD ["node", "server.js"]
