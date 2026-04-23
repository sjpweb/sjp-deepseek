# 国内可访问的 Node 镜像（阿里云）
FROM node:20-alpine AS builder

WORKDIR /app

#  npm 淘宝镜像（国内加速）
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com/
RUN npm install

# Prisma 客户端生成
COPY prisma ./prisma/
RUN npx prisma generate

# 复制源码并构建
COPY . .
RUN npm run build

# ------------------------------
# 运行阶段（轻量化，只复制必要文件）
# ------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# 从构建阶段复制必需文件（最小体积）
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000
CMD ["npm", "start"]