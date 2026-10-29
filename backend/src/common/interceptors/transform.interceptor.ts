import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  StreamableFile,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';

export interface Response<T> {
  success: boolean;
  data: T;
  message?: string;
  pagination?: any;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    const startTime = Date.now();
    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest();
    const method = req?.method || 'HTTP';
    const url = req?.originalUrl || req?.url || '';

    return next.handle().pipe(
      map((res) => {
        // A route returning a StreamableFile (e.g. screenshots/file/* -
        // now also serving PDF message attachments) must pass through as
        // the actual binary stream - wrapping it in {success, data, ...}
        // JSON like every other response silently corrupted every file
        // download from this endpoint into a JSON dump of the stream
        // object's internals instead of the file's real bytes.
        if (res instanceof StreamableFile) {
          return res as unknown as Response<T>;
        }
        if (res && typeof res === 'object' && 'data' in res && 'pagination' in res) {
          return {
            success: true,
            data: res.data,
            pagination: res.pagination,
            message: res.message || 'Operation successful',
          };
        }
        return {
          success: true,
          data: res,
          message: 'Operation successful',
        };
      }),
      tap((transformedRes) => {
        const duration = Date.now() - startTime;
        let payloadBytes = 0;
        try {
          if (transformedRes instanceof StreamableFile) {
            payloadBytes = -1;
          } else if (transformedRes !== undefined) {
            payloadBytes = Buffer.byteLength(JSON.stringify(transformedRes));
          }
        } catch {
          // ignore serialization size error
        }
        const sizeStr = payloadBytes >= 0 ? `${payloadBytes}B` : 'stream';
        if (duration > 200) {
          this.logger.warn(`[SLOW] ${method} ${url} ${duration}ms (${sizeStr})`);
        } else {
          this.logger.debug(`${method} ${url} ${duration}ms (${sizeStr})`);
        }
      }),
    );
  }
}
