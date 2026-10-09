import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';

@ApiTags('Starter')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Get the retained backend starter response' })
  @ApiOkResponse({
    description: 'Plain-text starter response.',
    content: {
      'text/plain': {
        schema: { type: 'string', example: 'Hello World!' },
      },
    },
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
