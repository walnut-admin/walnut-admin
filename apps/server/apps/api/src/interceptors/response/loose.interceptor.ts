import {
  CallHandler,
  ClassSerializerInterceptor,
  ExecutionContext,
  Injectable,
  PlainLiteralObject,
} from '@nestjs/common'
import { map, Observable } from 'rxjs'

// will return fields that are not defined in the target dto
@Injectable()
export class WalnutAdminInterceptorResponseLooseSerializer extends ClassSerializerInterceptor {
  // Nest 12 起基类 intercept 返回 Promise<Observable>，覆盖签名必须一致
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    return next.handle().pipe(
      map((res: PlainLiteralObject | PlainLiteralObject[]) =>
        this.serialize(res, {
          excludeExtraneousValues: false, // keep the undefined fields on dto
          enableCircularCheck: true,
        }),
      ),
    )
  }
}
