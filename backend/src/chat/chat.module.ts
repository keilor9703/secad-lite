import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MensajeChatEntity } from './mensaje.entity';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { CasosModule } from '../casos/casos.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([MensajeChatEntity]), CasosModule, AuthModule],
  providers: [ChatService, ChatGateway],
})
export class ChatModule {}
