FROM node:22-alpine AS frontend
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json* ./
RUN npm install
COPY dashboard/ .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY server/package.json server/package-lock.json* ./
RUN npm install --production
RUN apk del python3 make g++
COPY server/ .
COPY --from=frontend /app/dashboard/dist ./dashboard/dist
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "index.js"]
