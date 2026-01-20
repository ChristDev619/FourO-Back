# D:\FourO\FourO-Back\Dockerfile
FROM node:22.13.0

WORKDIR /app

# Copy manifests first (better cache)
COPY package*.json ./

# Prod deps + PM2
RUN npm ci --only=production && npm i -g pm2

# App source
COPY . .

# (If you need the cert)
RUN mkdir -p /app/certificates
COPY DigiCertGlobalRootCA.crt.pem /app/certificates/

# API port
EXPOSE 8011

# Run API and recalculation worker together
CMD ["pm2-runtime", "ecosystem.config.js"]
