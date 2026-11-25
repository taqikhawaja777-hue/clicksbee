import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { LeadSheetsService } from './lead-sheets.service';

export class CreateLeadSheetDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120)
  title: string;
}

export class UpdateLeadSheetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ description: 'Customer rows (see LEAD_FIELDS)' }) @IsOptional() @IsArray()
  rows?: unknown[];
}

export class SendLeadSheetDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  closerId: string;
}

export class ChatProofDto {
  @ApiProperty({ description: 'JPEG/PNG data URL, at most 1 MB' }) @IsString() @IsNotEmpty() @MaxLength(1_400_000)
  image: string;
}

// Who may open / edit a sheet is checked per sheet (sheetRights): creator, the chosen
// recipient once sent, Admin. Only Admin can download it.
@ApiTags('Lead Sheets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lead-sheets')
export class LeadSheetsController {
  constructor(private readonly sheets: LeadSheetsService) {}

  @ApiOperation({ summary: 'People the sheet can be sent to (Closers, Team Leads, Back Office)' })
  @Get('recipients')
  recipients(@Req() req: any) {
    return this.sheets.listRecipients(req.user.organizationId);
  }

  @ApiOperation({ summary: 'My sheets, sheets sent to me (closer), or all (Admin)' })
  @Get()
  list(@Req() req: any) {
    return this.sheets.list(req.user);
  }

  @ApiOperation({ summary: 'Start a new lead sheet (draft)' })
  @Post()
  create(@Req() req: any, @Body() dto: CreateLeadSheetDto) {
    return this.sheets.create(req.user, dto.title);
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.sheets.get(req.user, id);
  }

  @ApiOperation({ summary: 'Save rows / name (agent while draft; recipient after it is sent; Admin any time)' })
  @Put(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateLeadSheetDto) {
    return this.sheets.update(req.user, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.sheets.remove(req.user, id);
  }

  @ApiOperation({ summary: 'Send to a Closer / Team Lead / Back Office person - view only for the agent after this' })
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  send(@Req() req: any, @Param('id') id: string, @Body() dto: SendLeadSheetDto) {
    return this.sheets.send(req.user, id, dto.closerId);
  }

  @ApiOperation({ summary: 'Attach a chat-proof screenshot (anyone who may edit the sheet)' })
  @Post(':id/proofs')
  addProof(@Req() req: any, @Param('id') id: string, @Body() dto: ChatProofDto) {
    return this.sheets.addProof(req.user, id, dto.image);
  }

  @ApiOperation({ summary: 'Excel download - Admin/Boss only (recipients and agents cannot download)' })
  @Get(':id/download')
  download(@Req() req: any, @Param('id') id: string) {
    return this.sheets.download(req.user, id);
  }

  @ApiOperation({ summary: 'Chat-proof screenshot for viewing in the app' })
  @Get(':id/proofs/:proofId')
  proof(@Req() req: any, @Param('id') id: string, @Param('proofId') proofId: string) {
    return this.sheets.getProof(req.user, id, proofId);
  }
}
