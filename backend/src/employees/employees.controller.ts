import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';

@ApiTags('Employees')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @ApiOperation({ summary: 'Get all registered employees directly from MongoDB' })
  @Get()
  async getEmployees(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('departmentId') departmentId?: string,
    @Query('teamId') teamId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const orgId = req.user?.organizationId;
    if (!orgId) {
      return this.employeesService.getAllRegisteredEmployees();
    }
    return this.employeesService.getEmployees(
      orgId,
      search,
      departmentId,
      teamId,
      page ? +page : 1,
      limit ? +limit : 50,
    );
  }

  @ApiOperation({ summary: 'Get all registered employees (Public Dashboard)' })
  @Get('all')
  async getAllRegisteredEmployees() {
    return this.employeesService.getAllRegisteredEmployees();
  }

  @ApiOperation({ summary: 'Create new employee' })
  @Post()
  async createEmployee(
    @Req() req: any,
    @Body() dto: CreateEmployeeDto,
  ) {
    const orgId = req.user?.organizationId || 'org-101';
    return this.employeesService.createEmployee(orgId, dto);
  }

  @ApiOperation({ summary: 'Get employee profile by ID' })
  @Get(':id')
  async getEmployeeById(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const orgId = req.user?.organizationId || 'org-101';
    return this.employeesService.getEmployeeById(id, orgId);
  }

  @ApiOperation({ summary: 'Update employee' })
  @Patch(':id')
  async updateEmployee(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: UpdateEmployeeDto,
  ) {
    const orgId = req.user?.organizationId || 'org-101';
    return this.employeesService.updateEmployee(id, orgId, dto);
  }

  @ApiOperation({ summary: 'Check in employee' })
  @Post(':id/check-in')
  async checkInEmployee(@Param('id') id: string) {
    return this.employeesService.checkInEmployee(id);
  }

  @ApiOperation({ summary: 'Check out employee' })
  @Post(':id/check-out')
  async checkOutEmployee(@Param('id') id: string) {
    return this.employeesService.checkOutEmployee(id);
  }

  @ApiOperation({ summary: 'Delete employee' })
  @Delete(':id')
  async deleteEmployee(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const orgId = req.user?.organizationId || 'org-101';
    return this.employeesService.deleteEmployee(id, orgId);
  }
}
