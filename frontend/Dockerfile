# The dashboard ships as one self-contained file. Nginx serves it; there is no
# Node runtime in the image and nothing to CVE-scan beyond nginx itself.
FROM node:22-alpine AS build
WORKDIR /build
COPY standalone ./standalone
RUN cd standalone && node build.js

FROM nginx:1.27-alpine AS runtime
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV API_URL=${NEXT_PUBLIC_API_URL}

RUN rm -rf /usr/share/nginx/html/* && \
    addgroup -g 10001 -S web && adduser -u 10001 -S web -G web

COPY --from=build /build/dist/aapdasync.html /usr/share/nginx/html/index.html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Inject the live WebSocket URL at container start so one image serves any
# environment. The dashboard falls back to its simulated feed if unset.
RUN printf '#!/bin/sh\nset -e\nsed -i "s#</title>#</title><script>window.AAPDA_WS_URL=\\"${API_URL}\\".replace(/^http/,\\"ws\\").replace(/\\\\/api$//,\\"\\")+\\"/ws\\";</script>#" /usr/share/nginx/html/index.html\nexec nginx -g "daemon off;"\n' > /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:3000/ >/dev/null || exit 1
CMD ["/entrypoint.sh"]
