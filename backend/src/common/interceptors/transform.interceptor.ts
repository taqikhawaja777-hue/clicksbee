import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  success: boolean;
  data: T;
  message?: string;
  pagination?: any;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
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
    );
  }
}
