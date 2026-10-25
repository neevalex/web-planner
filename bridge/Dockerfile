FROM node:22-alpine
WORKDIR /bridge
COPY package.json ./
RUN npm install --omit=dev
COPY bridge.mjs ./
EXPOSE 8765 14550/udp
CMD ["node", "bridge.mjs", "--host", "0.0.0.0", "--port", "8765"]
