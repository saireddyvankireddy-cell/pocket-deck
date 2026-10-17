FROM node:24-bookworm-slim
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN node scripts/build.mjs
ENV SAI_PHOTOS_HOST=0.0.0.0
ENV PORT=4173
EXPOSE 4173
CMD ["node", "scripts/dev.mjs"]
