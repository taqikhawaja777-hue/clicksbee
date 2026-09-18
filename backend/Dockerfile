FROM node:20-alpine AS builder

WORKDIR /app

# Prisma's native query engine binary for Alpine (linux-musl) is linked
# against a real libssl - without it present here, `prisma generate` can't
# detect which OpenSSL version to target and silently guesses wrong (seen
# as "Defaulting to openssl-1.1.x" in the generate output), bundling an
# engine that doesn't match what's actually installed anywhere in this
# image.
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

# Same reason as the builder stage, but this time for the engine binary
# actually being loaded at runtime (dlopen) - without libssl present here
# too, the compiled engine fails with "Error loading shared library
# libssl.so.X: No such file or directory" on the very first Prisma call,
# regardless of whether the builder stage generated the right variant.
RUN apk add --no-cache openssl

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
# @prisma/client (node_modules/@prisma) is just a thin wrapper that
# re-exports from the actual generated client, which `prisma generate`
# puts in node_modules/.prisma (dot-prefixed) by default - copying only
# @prisma left every enum/type (Role, etc.) undefined at runtime, since
# the wrapper had nothing real to re-export.
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["node", "dist/main.js"]
