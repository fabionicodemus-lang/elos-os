FROM mcr.microsoft.com/playwright:v1.55.0-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm", "start"]
