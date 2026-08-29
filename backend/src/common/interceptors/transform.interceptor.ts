import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
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
