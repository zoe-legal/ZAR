FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_ZAR_BASE_URL
ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
ENV VITE_ZAR_BASE_URL=${VITE_ZAR_BASE_URL}
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5174
