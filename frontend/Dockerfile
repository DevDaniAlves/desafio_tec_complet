# Frontend do Nexo Assist (Railway / qualquer host Docker)
# O Vite embute a URL da API no build: defina VITE_API_URL como variável do serviço (a Railway a repassa como build arg).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.27-alpine
# O nginx oficial aplica envsubst em /etc/nginx/templates/*.template (só nas variáveis definidas, como PORT).
ENV PORT=8080
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
