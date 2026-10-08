FROM node:22-alpine AS build

WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @workspace/evexia-portal build


FROM nginx:alpine

COPY --from=build /workspace/artifacts/evexia-portal/dist/public /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
