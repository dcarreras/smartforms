# Stage 1: Runtime
FROM nginx:1.27-alpine-slim

LABEL maintainer="Sagar Shrestha"
LABEL description="Formblatt — 100% Client-Side Privacy-First PDF Form Creator"

# Remove default nginx welcome page
RUN rm -rf /usr/share/nginx/html/*

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy application assets
COPY index.html /usr/share/nginx/html/
COPY site.webmanifest /usr/share/nginx/html/
COPY sw.js /usr/share/nginx/html/
COPY server.cjs /usr/share/nginx/html/
COPY robots.txt /usr/share/nginx/html/
COPY sitemap.xml /usr/share/nginx/html/
COPY llms.txt /usr/share/nginx/html/
COPY llms-full.txt /usr/share/nginx/html/

# Copy application directories
COPY assets /usr/share/nginx/html/assets
COPY fonts /usr/share/nginx/html/fonts
COPY js /usr/share/nginx/html/js
COPY styles /usr/share/nginx/html/styles
COPY vendor /usr/share/nginx/html/vendor

# Healthcheck to verify the web server is responsive
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/health || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
