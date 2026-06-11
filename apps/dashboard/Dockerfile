# ADG governance dashboard — read-only SvelteKit app (adapter-node).
# The container holds only the app; mount the governed repo read-only at /repo:
#
#   docker build -t adg-dashboard apps/dashboard
#   docker run --rm -p 3000:3000 -v "$PWD:/repo:ro" adg-dashboard

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
# The data layer shells out to the sqlite3 CLI; nothing else is needed.
RUN apk add --no-cache sqlite
WORKDIR /app
COPY --from=build /app/build build
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json .

ENV NODE_ENV=production
ENV ADG_ROOT=/repo
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "build"]
