import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'
import { ALSRequestService } from '@/modules/shared/als/request/request.service'

@Injectable()
export class ALSRequestInterceptor implements NestInterceptor {
  constructor(private readonly asyncContext: ALSRequestService) {}

  intercept(context: ExecutionContext, next: CallHandler<any>) {
    return new Observable((subscriber) => {
      this.asyncContext.run(() => {
        next.handle().subscribe(subscriber)
      })
    })
  }
}
