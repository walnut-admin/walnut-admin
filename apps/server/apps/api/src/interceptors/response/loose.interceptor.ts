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
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
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
